// =====================================================================
// Swelli Pilot — Apps Script backend
//
// SETUP:
// 1. Create a new Google Sheet (any name, e.g. "Swelli Pilot Data").
// 2. Extensions → Apps Script. Delete any starter code, paste this whole
//    file in, and replace ALERT_EMAIL below with the real address that
//    should get instant safety alerts.
// 3. Deploy → New deployment → type "Web app".
//      Execute as: Me
//      Who has access: Anyone
// 4. Copy the resulting URL (ends in /exec) and paste it into data.js
//    as BACKEND_URL, then redeploy the site to Vercel.
// 5. The first time a request comes in, this script creates the
//    "Entries" and "Flags" tabs in your Sheet automatically.
// =====================================================================

const ALERT_EMAIL = 'YOUR-EMAIL@example.com'; // <-- replace this

function getSheet(name){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if(!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function doPost(e){
  const body = JSON.parse(e.postData.contents);
  const now = new Date();

  if(body.type === 'entry'){
    const sheet = getSheet('Entries');
    if(sheet.getLastRow() === 0){
      sheet.appendRow(['Timestamp','StudentId','StudentName','Mood','Note','Activity','ActivityDetail','ForCounselor','CounselorNote','Flagged','FlagCategories']);
    }
    const p = body.payload || {};
    sheet.appendRow([
      now, p.studentId || '', p.studentName || '', p.mood || '', p.note || '',
      p.activity || '', p.activityDetail || '', !!p.forCounselor, p.counselorNote || '',
      !!p.flagged, (p.flagCategories || []).join(', '),
    ]);
  }

  if(body.type === 'flag'){
    const sheet = getSheet('Flags');
    if(sheet.getLastRow() === 0){
      sheet.appendRow(['Timestamp','FlagId','StudentName','Category','Severity','Snippet','Source','Acknowledged']);
    }
    const p = body.payload || {};
    sheet.appendRow([now, p.id || '', p.studentName || '', p.category || '', p.severity || '', p.snippet || '', p.source || '', false]);

    if(p.severity === 'critical'){
      MailApp.sendEmail({
        to: ALERT_EMAIL,
        subject: `Swelli alert: ${p.studentName} — ${p.category}`,
        body: `${p.studentName} just submitted a flagged check-in.\n\n` +
              `Category: ${p.category}\nSeverity: ${p.severity}\nSource: ${p.source}\n` +
              `What they wrote: "${p.snippet}"\n\nTime: ${now}\n\n` +
              `Please follow your school's response process for this.`,
      });
    }
  }

  if(body.type === 'acknowledge'){
    const sheet = getSheet('Flags');
    const data = sheet.getDataRange().getValues();
    for(let i = 1; i < data.length; i++){
      if(data[i][1] === body.flagId){
        sheet.getRange(i + 1, 8).setValue(true);
        break;
      }
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e){
  const action = e.parameter.action;

  if(action === 'getFlags'){
    const sheet = getSheet('Flags');
    const data = sheet.getDataRange().getValues();
    const flags = [];
    for(let i = 1; i < data.length; i++){
      const row = data[i];
      if(row[7] !== true){
        flags.push({
          ts: new Date(row[0]).getTime(), id: row[1], studentName: row[2],
          category: row[3], severity: row[4], snippet: row[5], source: row[6],
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({ flags })).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}
