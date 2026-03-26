var SHEETS = {
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
  setupSpreadsheet();

  var action = param_(e, "action");
  var callback = param_(e, "callback");

  try {
    var response;

    if (action === "signin") {
      response = signIn_(param_(e, "studentNumber"), param_(e, "method") || "manual");
    } else if (action === "session") {
      response = {
        success: true,
        projectName: getProjectName_(),
        session: getCurrentSession_(),
      };
    } else if (action === "config") {
      response = {
        success: true,
        projectName: getProjectName_(),
      };
    } else {
      response = {
        success: false,
        message: "Invalid action.",
      };
    }

    return respond_(callback, response);
  } catch (error) {
    var session = tryGetCurrentSession_();
    return respond_(callback, {
      success: false,
      message: error.message || "Unknown error.",
      projectName: getProjectName_(),
      session: session ? session.sessionName : "",
      sessionTimes: session ? session.sessionTimes : "",
      day: session ? session.day : "",
      logBookHours: session ? session.logBookHours : "",
    });
  }
}

function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var attendanceSheet = getOrCreateSheet_(ss, SHEETS.ATTENDANCE, ATTENDANCE_HEADERS);
  var configSheet = getOrCreateSheet_(ss, SHEETS.CONFIG, CONFIG_HEADERS);

  if (configSheet.getLastRow() === 1) {
    configSheet.getRange(2, 1, 2, CONFIG_HEADERS.length).setValues([
      ["Example Project", "Tuesday Build", "Tuesday", "17:00", "20:00", 3, true],
      ["Example Project", "Thursday Build", "Thursday", "18:00", "20:00", 2, true],
    ]);
  }

  return {
    attendanceSheet: attendanceSheet,
    configSheet: configSheet,
  };
}

function cleanupAttendanceDuplicates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ATTENDANCE);
  if (!sheet || sheet.getLastRow() <= 1) {
    return { removed: 0 };
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ATTENDANCE_HEADERS.length).getValues();
  var seen = {};
  var duplicates = [];

  for (var i = 0; i < rows.length; i += 1) {
    var key = [toDateText_(rows[i][1]), text_(rows[i][2]).toUpperCase(), text_(rows[i][4])].join("|");
    if (seen[key]) {
      duplicates.push(i + 2);
    } else {
      seen[key] = true;
    }
  }

  deleteRows_(sheet, duplicates);
  return { removed: duplicates.length };
}

function signIn_(rawIdentifier, method) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var identifier = normalizeIdentifier_(rawIdentifier);
    var session = getCurrentSession_();
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.ATTENDANCE);
    var now = new Date();
    var tz = Session.getScriptTimeZone();
    var dateText = Utilities.formatDate(now, tz, "yyyy-MM-dd");
    var timestampText = Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm:ss");
    var duplicateRows = findDuplicateRows_(sheet, dateText, identifier, session.sessionName);

    if (duplicateRows.length > 0) {
      deleteRows_(sheet, duplicateRows.slice(1));
      return {
        success: false,
        duplicate: true,
        message: "Already signed in for this session.",
        studentNumber: identifier,
        session: session.sessionName,
        sessionTimes: session.sessionTimes,
        day: session.day,
        logBookHours: session.logBookHours,
        timestamp: timestampText,
      };
    }

    sheet.appendRow([
      timestampText,
      dateText,
      identifier,
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
      message: "Signed in " + identifier + ".",
      studentNumber: identifier,
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
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  var rows = sheet.getDataRange().getValues();
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var day = Utilities.formatDate(now, tz, "EEEE");
  var currentMinutes = Number(Utilities.formatDate(now, tz, "H")) * 60 + Number(Utilities.formatDate(now, tz, "m"));

  for (var i = 1; i < rows.length; i += 1) {
    var row = rows[i];
    var projectName = text_(row[0]);
    var sessionName = text_(row[1]);
    var sessionDay = text_(row[2]);
    var startTime = toTimeText_(row[3]);
    var endTime = toTimeText_(row[4]);

    if (!sessionName || !sessionDay || !startTime || !endTime || !isActive_(row[6]) || sessionDay !== day) {
      continue;
    }

    var startMinutes = toMinutes_(row[3]);
    var endMinutes = toMinutes_(row[4]);
    if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
      return {
        projectName: projectName || getProjectName_(),
        sessionName: sessionName,
        sessionTimes: startTime + " - " + endTime,
        day: sessionDay,
        logBookHours: Number(row[5]) || Number(((endMinutes - startMinutes) / 60).toFixed(2)),
      };
    }
  }

  throw new Error("No active session matches the current day and time.");
}

function getProjectName_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.CONFIG);
  if (!sheet || sheet.getLastRow() <= 1) {
    return "Project";
  }

  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < values.length; i += 1) {
    var projectName = text_(values[i][0]);
    if (projectName) {
      return projectName;
    }
  }

  return "Project";
}

function tryGetCurrentSession_() {
  try {
    return getCurrentSession_();
  } catch (_error) {
    return null;
  }
}

function findDuplicateRows_(sheet, dateText, identifier, sessionName) {
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }

  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, ATTENDANCE_HEADERS.length).getValues();
  var matches = [];

  for (var i = 0; i < rows.length; i += 1) {
    if (toDateText_(rows[i][1]) === dateText &&
        text_(rows[i][2]).toUpperCase() === identifier &&
        text_(rows[i][4]) === sessionName) {
      matches.push(i + 2);
    }
  }

  return matches;
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

function getOrCreateSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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

function deleteRows_(sheet, rowNumbers) {
  rowNumbers.sort(function (a, b) { return b - a; });
  for (var i = 0; i < rowNumbers.length; i += 1) {
    sheet.deleteRow(rowNumbers[i]);
  }
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
    return Utilities.formatDate(value, Session.getScriptTimeZone(), "HH:mm");
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
    ? Utilities.formatDate(value, Session.getScriptTimeZone(), "yyyy-MM-dd")
    : text_(value);
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

function param_(e, key) {
  return e && e.parameter && e.parameter[key] ? e.parameter[key] : "";
}
