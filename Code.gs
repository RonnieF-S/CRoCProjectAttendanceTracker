var SHEETS = {
  CONFIG: "Config",
  EVENTS: "Events",
  ATTENDANCE: "Attendance",
};

var CONFIG_HEADERS = [
  "Project Name",
  "Password",
  "Session Name",
  "Day",
  "Start Time",
  "End Time",
  "Active",
];

var EVENT_HEADERS = [
  "Timestamp",
  "Date",
  "Member ID",
  "Event Type",
  "Method",
  "Project Name",
  "Session Name",
  "Session Times",
  "Day",
  "Event ID",
  "Device ID",
];

var ATTENDANCE_HEADERS = [
  "Date",
  "Member ID",
  "Project Name",
  "Session Name",
  "Session Times",
  "Day",
  "Sign In",
  "Sign Out",
  "Attendance Hours",
  "Notes",
];

var CONFIG_CACHE_KEY = "configRows:v2";
var CONFIG_CACHE_TTL_SECONDS = 30;
var SHEETS_READY_CACHE_KEY = "sheetsReady:v2";
var SHEETS_READY_CACHE_TTL_SECONDS = 300;
var SETTINGS = {
  duplicateCooldownSeconds: 10,
  recentLimit: 12,
  syncBatchSize: 10,
};
var SCRIPT_TIMEZONE = Session.getScriptTimeZone();
var FORCED_SIGN_OUT_METHOD = "session_end";

function doGet(e) {
  ensureSpreadsheet_();

  var action = param_(e, "action");
  var callback = param_(e, "callback");

  try {
    return respond_(callback, handleAction_(action, e));
  } catch (error) {
    return respond_(callback, {
      success: false,
      message: error.message || "Unknown error.",
      projectName: getProjectName_(),
      sessionStatus: getSessionStatus_(),
    });
  }
}

function handleAction_(action, e) {
  if (action === "bootstrap" || action === "verify" || action === "session" || action === "config") {
    verifyPassword_(param_(e, "password"));
    return bootstrapResponse_();
  }

  if (action === "syncEvents") {
    verifyPassword_(param_(e, "password"));
    return syncEvents_(param_(e, "events"));
  }

  return {
    success: false,
    message: "Invalid action.",
  };
}

function setupSpreadsheet() {
  ensureSpreadsheet_(true);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var configSheet = ss.getSheetByName(SHEETS.CONFIG);
  var eventsSheet = ss.getSheetByName(SHEETS.EVENTS);
  var attendanceSheet = ss.getSheetByName(SHEETS.ATTENDANCE);

  if (configSheet.getLastRow() === 1) {
    configSheet.getRange(2, 1, 2, CONFIG_HEADERS.length).setValues([
      ["Example Project", "CR0C", "Tuesday Build", "Tuesday", "17:00", "20:00", true],
      ["Example Project", "CR0C", "Thursday Build", "Thursday", "18:00", "20:00", true],
    ]);
    clearConfigCache_();
  }

  return {
    configSheet: configSheet,
    eventsSheet: eventsSheet,
    attendanceSheet: attendanceSheet,
  };
}

function rebuildAttendance() {
  rebuildAttendance_();
}

function ensureSpreadsheet_(force) {
  var cache = CacheService.getScriptCache();
  if (!force && cache.get(SHEETS_READY_CACHE_KEY)) {
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  getOrCreateSheet_(ss, SHEETS.CONFIG, CONFIG_HEADERS);
  getOrCreateSheet_(ss, SHEETS.EVENTS, EVENT_HEADERS);
  getOrCreateSheet_(ss, SHEETS.ATTENDANCE, ATTENDANCE_HEADERS);
  cache.put(SHEETS_READY_CACHE_KEY, "1", SHEETS_READY_CACHE_TTL_SECONDS);
}

function bootstrapResponse_() {
  var settings = getSettings_();
  var sessionStatus = getSessionStatus_();
  var sessionDate = todayDateText_();

  return {
    success: true,
    projectName: settings.projectName,
    settings: {
      duplicateCooldownMs: settings.duplicateCooldownSeconds * 1000,
      recentLimit: settings.recentLimit,
      syncBatchSize: settings.syncBatchSize,
    },
    sessionStatus: sessionStatus,
    sessionDate: sessionDate,
    events: sessionStatus.currentSession ? getEventsForSession_(sessionStatus.currentSession, sessionDate) : [],
  };
}

function syncEvents_(eventsJson) {
  var events = parseEvents_(eventsJson);
  if (!events.length) {
    return {
      success: true,
      syncedEventIds: [],
      appendedCount: 0,
      duplicateCount: 0,
    };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EVENTS);
    var existingIds = getExistingEventIds_(sheet);
    var appendedRows = [];
    var syncedEventIds = [];
    var duplicateCount = 0;

    for (var i = 0; i < events.length; i += 1) {
      var event = normalizeIncomingEvent_(events[i]);
      if (existingIds[event.event_id]) {
        syncedEventIds.push(event.event_id);
        duplicateCount += 1;
        continue;
      }

      existingIds[event.event_id] = true;
      syncedEventIds.push(event.event_id);
      appendedRows.push([
        event.timestamp,
        event.date,
        event.member_id,
        event.event_type,
        event.method,
        event.project_name,
        event.session_name,
        event.session_times,
        event.day,
        event.event_id,
        event.device_id,
      ]);
    }

    if (appendedRows.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, appendedRows.length, EVENT_HEADERS.length).setValues(appendedRows);
      rebuildAttendance_();
    }

    return {
      success: true,
      syncedEventIds: syncedEventIds,
      appendedCount: appendedRows.length,
      duplicateCount: duplicateCount,
    };
  } finally {
    lock.releaseLock();
  }
}

function rebuildAttendance_() {
  var eventsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EVENTS);
  var attendanceSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ATTENDANCE);
  var notesByKey = getAttendanceNotesByKey_(attendanceSheet);
  var eventRows = eventsSheet.getLastRow() <= 1
    ? []
    : eventsSheet.getRange(2, 1, eventsSheet.getLastRow() - 1, EVENT_HEADERS.length).getValues();
  var grouped = {};
  var rows = [];

  for (var i = 0; i < eventRows.length; i += 1) {
    var event = rowToEvent_(eventRows[i]);
    var key = [event.date, event.member_id, event.session_name].join("|");
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(event);
  }

  for (var key in grouped) {
    if (!grouped.hasOwnProperty(key)) {
      continue;
    }

    var summary = summarizeAttendanceGroup_(grouped[key]);
    rows.push([
      summary.date,
      summary.member_id,
      summary.project_name,
      summary.session_name,
      summary.session_times,
      summary.day,
      summary.sign_in,
      summary.sign_out,
      summary.attendance_hours,
      notesByKey[key] || "",
    ]);
  }

  rows.sort(function (a, b) {
    if (a[0] !== b[0]) {
      return a[0] < b[0] ? -1 : 1;
    }
    if (a[3] !== b[3]) {
      return a[3] < b[3] ? -1 : 1;
    }
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });

  attendanceSheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]);
  attendanceSheet.setFrozenRows(1);

  if (attendanceSheet.getLastRow() > 1) {
    attendanceSheet.getRange(2, 1, attendanceSheet.getLastRow() - 1, ATTENDANCE_HEADERS.length).clearContent();
  }

  if (rows.length) {
    attendanceSheet.getRange(2, 1, rows.length, ATTENDANCE_HEADERS.length).setValues(rows);
  }
}

function summarizeAttendanceGroup_(events) {
  events.sort(function (a, b) {
    return sortTimestampMs_(a.timestamp) - sortTimestampMs_(b.timestamp);
  });

  var first = events[0];
  var summary = {
    date: first.date,
    member_id: first.member_id,
    project_name: first.project_name,
    session_name: first.session_name,
    session_times: first.session_times,
    day: first.day,
    sign_in: "",
    sign_out: "",
    attendance_hours: 0,
  };
  var openTimestamp = "";

  for (var i = 0; i < events.length; i += 1) {
    if (events[i].event_type === "sign_in") {
      if (!openTimestamp) {
        openTimestamp = events[i].timestamp;
        if (!summary.sign_in) {
          summary.sign_in = events[i].raw_timestamp;
        }
      }
      continue;
    }

    if (events[i].event_type === "sign_out" && openTimestamp) {
      summary.sign_out = events[i].raw_timestamp;
      if (events[i].method === FORCED_SIGN_OUT_METHOD) {
        summary.attendance_hours = Math.max(summary.attendance_hours, 1);
      } else {
        summary.attendance_hours += minutesBetween_(openTimestamp, events[i].timestamp) / 60;
      }
      openTimestamp = "";
    }
  }

  if (openTimestamp && sessionHasEnded_(summary.date, summary.session_times)) {
    summary.attendance_hours = Math.max(summary.attendance_hours, 1);
  }

  summary.attendance_hours = Number(summary.attendance_hours.toFixed(2));
  return summary;
}

function getAttendanceNotesByKey_(sheet) {
  var notesByKey = {};
  if (!sheet || sheet.getLastRow() <= 1) {
    return notesByKey;
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ATTENDANCE_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i += 1) {
    var key = [text_(rows[i][0]), text_(rows[i][1]).toUpperCase(), text_(rows[i][3])].join("|");
    notesByKey[key] = text_(rows[i][9]);
  }
  return notesByKey;
}

function getExistingEventIds_(sheet) {
  var ids = {};
  if (!sheet || sheet.getLastRow() <= 1) {
    return ids;
  }

  var values = sheet.getRange(2, 10, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var id = text_(values[i][0]);
    if (id) {
      ids[id] = true;
    }
  }
  return ids;
}

function getEventsForSession_(session, dateText) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.EVENTS);
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, EVENT_HEADERS.length).getValues();
  var events = [];

  for (var i = 0; i < rows.length; i += 1) {
    if (toDateText_(rows[i][1]) !== dateText || text_(rows[i][6]) !== session.sessionName) {
      continue;
    }
    events.push(rowToEvent_(rows[i]));
  }

  events.sort(function (a, b) {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
  return events;
}

function rowToEvent_(row) {
  var rawTimestamp = toTimestampText_(row[0]);
  return {
    raw_timestamp: rawTimestamp,
    timestamp: clientTimestamp_(rawTimestamp),
    date: toDateText_(row[1]),
    member_id: text_(row[2]).toUpperCase(),
    event_type: text_(row[3]),
    method: text_(row[4]),
    project_name: text_(row[5]),
    session_name: text_(row[6]),
    session_times: text_(row[7]),
    day: text_(row[8]),
    event_id: text_(row[9]),
    device_id: text_(row[10]),
    synced: true,
  };
}

function parseEvents_(eventsJson) {
  if (!eventsJson) {
    return [];
  }

  var parsed = JSON.parse(eventsJson);
  if (Object.prototype.toString.call(parsed) !== "[object Array]") {
    throw new Error("Events payload must be an array.");
  }
  return parsed;
}

function normalizeIncomingEvent_(event) {
  var memberId = normalizeIdentifier_(event.member_id || event.memberId);
  var eventType = text_(event.event_type || event.eventType);
  var timestamp = text_(event.timestamp);
  var parsedTimestamp = new Date(timestamp);
  var sessionName = text_(event.session_name || event.sessionName);

  if (eventType !== "sign_in" && eventType !== "sign_out") {
    throw new Error("Event type must be sign_in or sign_out.");
  }
  if (!timestamp || isNaN(parsedTimestamp.getTime())) {
    throw new Error("Event timestamp is invalid.");
  }
  if (!text_(event.event_id || event.eventId)) {
    throw new Error("Event ID is required.");
  }
  if (!sessionName) {
    throw new Error("Session name is required.");
  }

  return {
    event_id: text_(event.event_id || event.eventId),
    member_id: memberId,
    project_name: text_(event.project_name || event.projectName) || getProjectName_(),
    session_name: sessionName,
    event_type: eventType,
    timestamp: Utilities.formatDate(parsedTimestamp, SCRIPT_TIMEZONE, "yyyy-MM-dd HH:mm:ss"),
    date: Utilities.formatDate(parsedTimestamp, SCRIPT_TIMEZONE, "yyyy-MM-dd"),
    device_id: text_(event.device_id || event.deviceId),
    method: text_(event.method) || "barcode",
    session_times: text_(event.session_times || event.sessionTimes),
    day: text_(event.day) || Utilities.formatDate(parsedTimestamp, SCRIPT_TIMEZONE, "EEEE"),
  };
}

function getCurrentSession_() {
  var status = getSessionStatus_();
  if (status.currentSession) {
    return status.currentSession;
  }
  throw new Error("No active session matches the current day and time.");
}

function getSessionStatus_() {
  var rows = getConfigRows_();
  var now = new Date();
  var day = Utilities.formatDate(now, SCRIPT_TIMEZONE, "EEEE");
  var currentMinutes = Number(Utilities.formatDate(now, SCRIPT_TIMEZONE, "H")) * 60 +
    Number(Utilities.formatDate(now, SCRIPT_TIMEZONE, "m"));
  var currentDayIndex = dayIndex_(day);
  var nextSession = null;
  var nextOffset = null;

  for (var i = 0; i < rows.length; i += 1) {
    var session = sessionFromRow_(rows[i]);
    if (!session) {
      continue;
    }

    if (session.day === day && currentMinutes >= session.startMinutes && currentMinutes < session.endMinutes) {
      return {
        isOpen: true,
        currentSession: session,
        nextSession: null,
      };
    }

    var offset = minutesUntilSession_(currentDayIndex, currentMinutes, session.dayIndex, session.startMinutes);
    if (nextOffset === null || offset < nextOffset) {
      nextOffset = offset;
      nextSession = session;
    }
  }

  return {
    isOpen: false,
    currentSession: null,
    nextSession: nextSession,
  };
}

function sessionFromRow_(row) {
  var sessionName = text_(row[2]);
  var sessionDay = text_(row[3]);
  var startTime = text_(row[4]);
  var endTime = text_(row[5]);

  if (!sessionName || !sessionDay || !startTime || !endTime || !isActive_(row[6])) {
    return null;
  }

  var startMinutes = toMinutes_(startTime);
  var endMinutes = toMinutes_(endTime);

  return {
    projectName: text_(row[0]) || getProjectName_(),
    sessionName: sessionName,
    sessionTimes: startTime + " - " + endTime,
    day: sessionDay,
    startTime: startTime,
    endTime: endTime,
    dayIndex: dayIndex_(sessionDay),
    startMinutes: startMinutes,
    endMinutes: endMinutes,
  };
}

function getSettings_() {
  return {
    projectName: getProjectName_(),
    password: getAccessPassword_(),
    duplicateCooldownSeconds: SETTINGS.duplicateCooldownSeconds,
    recentLimit: SETTINGS.recentLimit,
    syncBatchSize: SETTINGS.syncBatchSize,
  };
}

function getProjectName_() {
  return getFirstConfigValue_(0, "Project");
}

function getAccessPassword_() {
  return getFirstConfigValue_(1, "");
}

function getConfigRows_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(CONFIG_CACHE_KEY);
  if (cached) {
    return JSON.parse(cached);
  }

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var rawRows = sheet.getRange(2, 1, sheet.getLastRow() - 1, CONFIG_HEADERS.length).getValues();
  var rows = [];

  for (var i = 0; i < rawRows.length; i += 1) {
    rows.push([
      text_(rawRows[i][0]),
      text_(rawRows[i][1]),
      text_(rawRows[i][2]),
      text_(rawRows[i][3]),
      toTimeText_(rawRows[i][4]),
      toTimeText_(rawRows[i][5]),
      text_(rawRows[i][6]),
    ]);
  }

  cache.put(CONFIG_CACHE_KEY, JSON.stringify(rows), CONFIG_CACHE_TTL_SECONDS);
  return rows;
}

function getFirstConfigValue_(columnIndex, fallback) {
  var rows = getConfigRows_();
  for (var i = 0; i < rows.length; i += 1) {
    var value = text_(rows[i][columnIndex]);
    if (value) {
      return value;
    }
  }
  return fallback;
}

function verifyPassword_(password) {
  var configuredPassword = getAccessPassword_();
  if (!configuredPassword) {
    throw new Error("Backend access password is not configured.");
  }
  if (text_(password) !== configuredPassword) {
    throw new Error("The access password is incorrect.");
  }
}

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var currentHeaders = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
    if (currentHeaders.join("|") !== headers.join("|")) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  if (sheet.getFrozenRows() !== 1) {
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function respond_(callback, data) {
  var output = callback ? callback + "(" + JSON.stringify(data) + ")" : JSON.stringify(data);
  return ContentService
    .createTextOutput(output)
    .setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

function normalizeIdentifier_(value) {
  var cleaned = text_(value).toUpperCase().replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("No student or staff number was provided.");
  }
  if (/^\d{8}$/.test(cleaned) || /^\d{6}[A-Z]$/.test(cleaned)) {
    return cleaned;
  }

  var suffix = cleaned.slice(3);
  if (/^\d{8}$/.test(suffix) || /^\d{6}[A-Z]$/.test(suffix)) {
    return suffix;
  }

  throw new Error("Identifier must be a student number like xxx12345678 or a staff number like xxx123456A.");
}

function toMinutes_(value) {
  var text = toTimeText_(value);
  var match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error("Session time must use HH:MM format, for example 17:00.");
  }

  var hours = Number(match[1]);
  var minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("Session time is out of range: " + text);
  }

  return hours * 60 + minutes;
}

function toTimeText_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, SCRIPT_TIMEZONE, "HH:mm");
  }
  if (typeof value === "number" && isFinite(value)) {
    var totalMinutes = Math.round(value * 24 * 60);
    return pad2_(Math.floor(totalMinutes / 60) % 24) + ":" + pad2_(totalMinutes % 60);
  }

  var text = text_(value);
  var longTime = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  return longTime ? pad2_(Number(longTime[1])) + ":" + pad2_(Number(longTime[2])) : text;
}

function toDateText_(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())
    ? Utilities.formatDate(value, SCRIPT_TIMEZONE, "yyyy-MM-dd")
    : text_(value);
}

function todayDateText_() {
  return Utilities.formatDate(new Date(), SCRIPT_TIMEZONE, "yyyy-MM-dd");
}

function minutesUntilSession_(currentDayIndex, currentMinutes, sessionDayIndex, startMinutes) {
  var dayDelta = (sessionDayIndex - currentDayIndex + 7) % 7;
  var minuteDelta = startMinutes - currentMinutes;
  var total = dayDelta * 24 * 60 + minuteDelta;
  return total > 0 ? total : total + 7 * 24 * 60;
}

function minutesBetween_(startText, endText) {
  var startMs = parseTimestampMs_(startText);
  var endMs = parseTimestampMs_(endText);
  if (isNaN(startMs) || isNaN(endMs)) {
    return 0;
  }
  return Math.max(0, Math.round((endMs - startMs) / 60000));
}

function sessionHasEnded_(dateText, sessionTimes) {
  var endTime = sessionEndTime_(sessionTimes);
  if (!endTime) {
    return false;
  }

  var today = todayDateText_();
  if (today > dateText) {
    return true;
  }
  if (today < dateText) {
    return false;
  }

  var now = new Date();
  var currentMinutes = Number(Utilities.formatDate(now, SCRIPT_TIMEZONE, "H")) * 60 +
    Number(Utilities.formatDate(now, SCRIPT_TIMEZONE, "m"));
  return currentMinutes >= toMinutes_(endTime);
}

function sessionEndTime_(sessionTimes) {
  var parts = text_(sessionTimes).split(" - ");
  return parts.length === 2 ? parts[1] : "";
}

function isActive_(value) {
  var text = text_(value).toUpperCase();
  return text === "" || text === "TRUE" || text === "YES" || text === "Y" || text === "1";
}

function text_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function pad2_(value) {
  return value < 10 ? "0" + value : String(value);
}

function dayIndex_(dayName) {
  var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var index = days.indexOf(dayName);
  if (index === -1) {
    throw new Error("Invalid day name in Config: " + dayName);
  }
  return index;
}

function clearConfigCache_() {
  CacheService.getScriptCache().remove(CONFIG_CACHE_KEY);
}

function clientTimestamp_(value) {
  return text_(value).replace(" ", "T");
}

function parseTimestampMs_(value) {
  var direct = new Date(value).getTime();
  if (!isNaN(direct)) {
    return direct;
  }
  return new Date(clientTimestamp_(value)).getTime();
}

function sortTimestampMs_(value) {
  return parseTimestampMs_(value) || 0;
}

function toTimestampText_(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())
    ? Utilities.formatDate(value, SCRIPT_TIMEZONE, "yyyy-MM-dd HH:mm:ss")
    : text_(value);
}

function param_(e, key) {
  return e && e.parameter && e.parameter[key] ? e.parameter[key] : "";
}
