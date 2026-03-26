var SHEET_NAMES = {
  ATTENDANCE: "Attendance",
  CONFIG: "Config",
};

var ATTENDANCE_HEADERS = [
  "Timestamp",
  "Date",
  "Student Number",
  "Method",
  "Session Name",
  "Session Times",
  "Day",
  "Log book hours",
  "Notes",
];

var CONFIG_HEADERS = [
  "Project Name",
  "Session Name",
  "Day",
  "Start Time",
  "End Time",
  "Log book hours",
  "Active",
];

function doGet(e) {
  var action = getParam_(e, "action");
  var callback = getParam_(e, "callback");

  try {
    if (action === "signin") {
      var identifier = getParam_(e, "studentNumber");
      var method = getParam_(e, "method") || "manual";
      return jsonpResponse_(callback, signInMember_(identifier, method));
    }

    if (action === "session") {
      var session = getCurrentSession_();
      return jsonpResponse_(callback, {
        success: true,
        projectName: getProjectName_(),
        session: session,
      });
    }

    if (action === "config") {
      return jsonpResponse_(callback, {
        success: true,
        projectName: getProjectName_(),
      });
    }

    return jsonpResponse_(callback, {
      success: false,
      message: "Invalid action.",
    });
  } catch (error) {
    return jsonpResponse_(callback, {
      success: false,
      message: error.message || "Unknown error.",
    });
  }
}

function setupSpreadsheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  var attendanceSheet = spreadsheet.getSheetByName(SHEET_NAMES.ATTENDANCE);
  if (!attendanceSheet) {
    attendanceSheet = spreadsheet.insertSheet(SHEET_NAMES.ATTENDANCE);
  }
  ensureHeaders_(attendanceSheet, ATTENDANCE_HEADERS);

  var configSheet = spreadsheet.getSheetByName(SHEET_NAMES.CONFIG);
  if (!configSheet) {
    configSheet = spreadsheet.insertSheet(SHEET_NAMES.CONFIG);
  }
  ensureHeaders_(configSheet, CONFIG_HEADERS);

  if (configSheet.getLastRow() === 1) {
    configSheet.getRange(2, 1, 2, CONFIG_HEADERS.length).setValues([
      ["Example Project", "Tuesday Build", "Tuesday", "17:00", "20:00", 3, true],
      ["Example Project", "Thursday Build", "Thursday", "18:00", "20:00", 2, true],
    ]);
  }
}

function signInMember_(rawIdentifier, method) {
  setupSpreadsheet();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
  var normalizedIdentifier = normalizeIdentifier_(rawIdentifier);
  var session = getCurrentSession_();
  var attendanceSheet = getAttendanceSheet_();
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var dateText = Utilities.formatDate(now, tz, "yyyy-MM-dd");
  var timestampText = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");

  var duplicateRows = findDuplicateRows_(
    attendanceSheet,
    dateText,
    normalizedIdentifier,
    session.sessionName
  );

  if (duplicateRows.length > 0) {
    removeRowsByIndexDescending_(attendanceSheet, duplicateRows.slice(1));

    return {
      success: false,
      duplicate: true,
      studentNumber: normalizedIdentifier,
      message: "Already signed in for this session.",
      session: session.sessionName,
      sessionTimes: session.sessionTimes,
      day: session.day,
      logBookHours: session.logBookHours,
      timestamp: timestampText,
    };
  }

  attendanceSheet.appendRow([
    timestampText,
    dateText,
    normalizedIdentifier,
    method,
    session.sessionName,
    session.sessionTimes,
    session.day,
    session.logBookHours,
    "",
  ]);

  return {
    success: true,
    duplicate: false,
    studentNumber: normalizedIdentifier,
    message: "Signed in " + normalizedIdentifier + ".",
    session: session.sessionName,
    sessionTimes: session.sessionTimes,
    day: session.day,
    logBookHours: session.logBookHours,
    timestamp: timestampText,
  };
  } finally {
    lock.releaseLock();
  }
}

function getCurrentSession_() {
  setupSpreadsheet();

  var sessionsSheet = getSessionSheet_();
  var values = sessionsSheet.getDataRange().getValues();
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var dayName = Utilities.formatDate(now, tz, "EEEE");
  var currentMinutes = Number(Utilities.formatDate(now, tz, "H")) * 60 +
    Number(Utilities.formatDate(now, tz, "m"));

  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var projectName = cleanString_(row[0]);
    var sessionName = cleanString_(row[1]);
    var day = cleanString_(row[2]);
    var startTime = formatTimeValue_(row[3]);
    var endTime = formatTimeValue_(row[4]);
    var logBookHours = row[5];
    var active = isSessionActive_(row[6]);

    if (!sessionName || !day || !startTime || !endTime || !active) {
      continue;
    }

    if (day !== dayName) {
      continue;
    }

    var startMinutes = parseTimeToMinutes_(startTime);
    var endMinutes = parseTimeToMinutes_(endTime);
    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      return {
        projectName: projectName || getProjectName_(),
        sessionName: sessionName,
        day: day,
        startTime: startTime,
        endTime: endTime,
        sessionTimes: startTime + " - " + endTime,
        logBookHours: Number(logBookHours) || calculateHours_(startMinutes, endMinutes),
      };
    }
  }

  throw new Error("No active session matches the current day and time.");
}

function cleanupAttendanceDuplicates() {
  setupSpreadsheet();

  var sheet = getAttendanceSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length <= 1) {
    return { removed: 0 };
  }

  var seen = {};
  var rowsToDelete = [];

  for (var i = 1; i < values.length; i += 1) {
    var row = values[i];
    var key = [
      cleanString_(row[1]),
      cleanString_(row[2]).toUpperCase(),
      cleanString_(row[4]),
    ].join("|");

    if (seen[key]) {
      rowsToDelete.push(i + 1);
    } else {
      seen[key] = true;
    }
  }

  removeRowsByIndexDescending_(sheet, rowsToDelete);

  return {
    removed: rowsToDelete.length,
  };
}

function jsonpResponse_(callback, data) {
  var json = JSON.stringify(data);

  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function getAttendanceSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.ATTENDANCE);
  if (!sheet) {
    throw new Error("Missing Attendance sheet.");
  }
  return sheet;
}

function getSessionSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.CONFIG);
  if (!sheet) {
    throw new Error("Missing Config sheet.");
  }
  return sheet;
}

function getProjectName_() {
  setupSpreadsheet();

  var sheet = getSessionSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return "Project";
  }

  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var projectName = cleanString_(values[i][0]);
    if (projectName) {
      return projectName;
    }
  }

  return "Project";
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }

  var existingHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var needsUpdate = false;

  for (var i = 0; i < headers.length; i += 1) {
    if (existingHeaders[i] !== headers[i]) {
      needsUpdate = true;
      break;
    }
  }

  if (needsUpdate) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function getParam_(e, key) {
  return e && e.parameter && e.parameter[key] ? e.parameter[key] : "";
}

function normalizeIdentifier_(value) {
  var cleaned = cleanString_(value).toUpperCase().replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("No student or staff number was provided.");
  }

  if (/^\d{8}$/.test(cleaned)) {
    return cleaned;
  }

  if (/^\d{6}[A-Z]$/.test(cleaned)) {
    return cleaned;
  }

  if (cleaned.length > 3) {
    var suffix = cleaned.slice(3);

    if (/^\d{8}$/.test(suffix)) {
      return suffix;
    }

    if (/^\d{6}[A-Z]$/.test(suffix)) {
      return suffix;
    }
  }

  throw new Error("Identifier must be a student number like xxx12345678 or a staff number like xxx123456A.");
}

function findDuplicateRows_(sheet, dateText, identifier, sessionName) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    return [];
  }

  var values = sheet.getRange(2, 1, lastRow - 1, ATTENDANCE_HEADERS.length).getValues();
  var matches = [];

  for (var i = 0; i < values.length; i += 1) {
    var row = values[i];
    var rowDate = formatDateValue_(row[1]);
    var rowIdentifier = cleanString_(row[2]).toUpperCase();
    var rowSessionName = cleanString_(row[4]);

    if (rowDate === dateText &&
        rowIdentifier === identifier &&
        rowSessionName === sessionName) {
      matches.push(i + 2);
    }
  }

  return matches;
}

function removeRowsByIndexDescending_(sheet, rowIndexes) {
  if (!rowIndexes || rowIndexes.length === 0) {
    return;
  }

  var sorted = rowIndexes.slice().sort(function (a, b) {
    return b - a;
  });

  for (var i = 0; i < sorted.length; i += 1) {
    sheet.deleteRow(sorted[i]);
  }
}

function parseTimeToMinutes_(value) {
  var text = formatTimeValue_(value);
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

function calculateHours_(startMinutes, endMinutes) {
  return Number(((endMinutes - startMinutes) / 60).toFixed(2));
}

function isSessionActive_(value) {
  var text = cleanString_(value).toUpperCase();
  return text === "" || text === "TRUE" || text === "YES" || text === "Y" || text === "1";
}

function cleanString_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function formatTimeValue_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
  }

  if (typeof value === "number" && isFinite(value)) {
    var totalMinutes = Math.round(value * 24 * 60);
    var hours = Math.floor(totalMinutes / 60) % 24;
    var minutes = totalMinutes % 60;
    return pad2_(hours) + ":" + pad2_(minutes);
  }

  var text = cleanString_(value);
  var longMatch = text.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (longMatch) {
    return pad2_(Number(longMatch[1])) + ":" + pad2_(Number(longMatch[2]));
  }

  return text;
}

function formatDateValue_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  return cleanString_(value);
}

function pad2_(value) {
  return value < 10 ? "0" + value : String(value);
}
