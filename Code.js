/**
 * @fileoverview Backend controller for the Event Check-In System.
 * Follows Single Responsibility Principle (SRP).
 * All functions are named for what they do, each doing one thing.
 */

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================

const DB = {
  MASTER: "Participants",
  CONFIG:  "Config",
  AUDIT:   "Audit_Log",

  // Column indices (0-based) in the Master sheet
  COL_ROLL_NO: 0,   // Column A
  COL_NAME:    1,   // Column B
  COL_PAYMENT: 10,  // Column K
};

const STATUS = {
  SUCCESS:  "SUCCESS",
  REJECTED: "REJECTED",
  FAILED:   "FAILED",
  ERROR:    "ERROR",
};

// ==========================================
// WEB APP ENTRY POINT
// ==========================================

/**
 * Serves the frontend HTML interface.
 * @return {HtmlOutput}
 */
function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Check-In Utility")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

// ==========================================
// PUBLIC API — called by the frontend
// ==========================================

/**
 * Returns event configurations from the Config sheet.
 * Called by the frontend on load to populate the event dropdown.
 * @return {Array<Object>} Array of { eventName, masterCol, targetSheet }.
 */
function getEventConfig() {
  try {
    const sheet = getSheetOrThrow(DB.CONFIG);
    const rows  = sheet.getDataRange().getValues().slice(1); // skip header

    if (rows.length === 0) {
      throw new Error("Config sheet is empty — no events configured.");
    }

    return rows.map(function(row) {
      return {
        eventName:   row[0],
        masterCol:   columnLetterToNumber(row[1]),
        targetSheet: row[2],
      };
    });

  } catch (e) {
    Logger.log("[getEventConfig] ERROR: " + e.message);
    throw e; // surface to frontend withFailureHandler
  }
}

/**
 * Main entry point for processing a single check-in request.
 * Uses LockService to prevent race conditions under concurrent scans.
 *
 * @param {string} rollNo        - Scanned or typed participant ID.
 * @param {Object} eventData     - Active event config { eventName, masterCol, targetSheet }.
 * @param {string} checkpoint    - Physical location label (e.g. "Main Gate").
 * @return {Object}              - Standardised { success, message, type }.
 */
function processCheckIn(rollNo, eventData, checkpoint) {
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(10000);
    return runCheckIn(rollNo, eventData, checkpoint);
  } catch (e) {
    Logger.log("[processCheckIn] LOCK/SYSTEM ERROR: " + e.message);
    return formatResponse(false, "System Error: " + e.message, "error");
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// CHECK-IN PIPELINE (private, ordered steps)
// ==========================================

/**
 * Orchestrates the full check-in flow in clear sequential steps.
 * @private
 */
function runCheckIn(rollNo, eventData, checkpoint) {
  const ss          = SpreadsheetApp.getActiveSpreadsheet();
  const masterSheet = getSheetOrThrow(DB.MASTER, ss);
  const masterData  = masterSheet.getDataRange().getValues();

  // Step 1 — Find participant
  const rowIndex = findParticipantRowIndex(masterData, rollNo);
  if (rowIndex === -1) {
    writeAuditRecord(ss, rollNo, eventData.eventName, checkpoint, STATUS.FAILED, "Roll No Not Found");
    return formatResponse(false, "Roll No Not Found", "error");
  }

  const participantRow = masterData[rowIndex];
  const participantName = participantRow[DB.COL_NAME];

  // Step 2 — Validate eligibility
  const eventColIndex = eventData.masterCol - 1; // convert to 0-based
  const eligibility   = checkParticipantEligibility(participantRow, eventColIndex);
  if (!eligibility.eligible) {
    writeAuditRecord(ss, rollNo, eventData.eventName, checkpoint, STATUS.REJECTED, eligibility.reason);
    return formatResponse(false, eligibility.reason, "warning");
  }

  // Step 3 — Commit the check-in to all relevant sheets
  const sheetRowNumber = rowIndex + 1; // convert to 1-based for Sheets API
  markParticipantCheckedIn(masterSheet, sheetRowNumber, eventData.masterCol);
  appendToEventLog(ss, eventData.targetSheet, rollNo, participantName, checkpoint);

  // Step 4 — Write success audit record
  writeAuditRecord(ss, rollNo, eventData.eventName, checkpoint, STATUS.SUCCESS, "Check-in Complete");

  return formatResponse(true, "Welcome, " + participantName, "success");
}

// ==========================================
// DATA LOOKUP
// ==========================================

/**
 * Searches the master data for a matching Roll Number (case-insensitive).
 * @param {Array<Array>} data  - Full 2-D array from the master sheet.
 * @param {string}       id   - The roll number to find.
 * @return {number}           - Row index in `data`, or -1 if not found.
 */
function findParticipantRowIndex(data, id) {
  const normalised = id.toString().trim().toLowerCase();
  for (var i = 1; i < data.length; i++) { // i=1 skips header row
    if (data[i][DB.COL_ROLL_NO].toString().trim().toLowerCase() === normalised) {
      return i;
    }
  }
  return -1;
}

// ==========================================
// VALIDATION
// ==========================================

/**
 * Checks whether a participant is eligible to check in.
 * @param {Array}  row          - Participant row from master data.
 * @param {number} eventColIdx  - 0-based column index for this event's status.
 * @return {{ eligible: boolean, reason: string }}
 */
function checkParticipantEligibility(row, eventColIdx) {
  if (row[DB.COL_PAYMENT] !== "Paid") {
    return { eligible: false, reason: "Payment Status: " + row[DB.COL_PAYMENT] };
  }
  if (row[eventColIdx] === "Checked-in") {
    return { eligible: false, reason: "Already Checked-in for this event" };
  }
  return { eligible: true, reason: "" };
}

// ==========================================
// DATABASE WRITES
// ==========================================

/**
 * Marks the participant's event column as "Checked-in" in the Master sheet.
 * @param {Sheet}  masterSheet - The master participants sheet object.
 * @param {number} rowNum      - 1-based row number to update.
 * @param {number} colNum      - 1-based column number for the event status.
 */
function markParticipantCheckedIn(masterSheet, rowNum, colNum) {
  masterSheet.getRange(rowNum, colNum).setValue("Checked-in");
}

/**
 * Appends a row to the event-specific log sheet (creates sheet + header if needed).
 * @param {Spreadsheet} ss          - Active spreadsheet.
 * @param {string}      sheetName   - Target sheet name from event config.
 * @param {string}      rollNo      - Participant ID.
 * @param {string}      name        - Participant full name.
 * @param {string}      checkpoint  - Station label.
 */
function appendToEventLog(ss, sheetName, rollNo, name, checkpoint) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    Logger.log("[appendToEventLog] Created new sheet: " + sheetName);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Roll_No", "Full_Name", "Checkpoint", "Timestamp"]);
  }
  sheet.appendRow([rollNo, name, checkpoint, new Date()]);
}

/**
 * Appends an immutable audit record to the global Audit_Log sheet.
 * @param {Spreadsheet} ss          - Active spreadsheet.
 * @param {string}      rollNo      - Participant ID.
 * @param {string}      eventName   - Event name.
 * @param {string}      checkpoint  - Station label.
 * @param {string}      status      - One of STATUS constants.
 * @param {string}      detail      - Human-readable result message.
 */
function writeAuditRecord(ss, rollNo, eventName, checkpoint, status, detail) {
  var sheet = ss.getSheetByName(DB.AUDIT);
  if (!sheet) {
    sheet = ss.insertSheet(DB.AUDIT);
    Logger.log("[writeAuditRecord] Created Audit_Log sheet.");
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Roll_No", "Event", "Checkpoint", "Status", "Result_Message"]);
  }
  sheet.appendRow([new Date(), rollNo, eventName, checkpoint, status, detail]);
}

// ==========================================
// UTILITY HELPERS
// ==========================================

/**
 * Returns a sheet by name, throwing a descriptive error if it doesn't exist.
 * @param {string}      name  - Sheet name.
 * @param {Spreadsheet} [ss]  - Optional spreadsheet; defaults to active.
 * @return {Sheet}
 */
function getSheetOrThrow(name, ss) {
  var spreadsheet = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    throw new Error('Required sheet "' + name + '" not found. Please check your spreadsheet setup.');
  }
  return sheet;
}

/**
 * Converts a spreadsheet column letter (A, Z, AA …) to a 1-based integer.
 * @param {string} letter - Column letter(s).
 * @return {number}
 */
function columnLetterToNumber(letter) {
  var column = 0;
  var upper  = letter.toUpperCase();
  for (var i = 0; i < upper.length; i++) {
    column += (upper.charCodeAt(i) - 64) * Math.pow(26, upper.length - i - 1);
  }
  return column;
}

/**
 * Creates a standardised response object for the frontend.
 * @param {boolean} success
 * @param {string}  message
 * @param {string}  type     - "success" | "warning" | "error"
 * @return {{ success: boolean, message: string, type: string }}
 */
function formatResponse(success, message, type) {
  return { success: success, message: message, type: type };
}