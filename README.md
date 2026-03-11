# Event Check-In Utility

A QR-based event check-in system built using **Google Apps Script, HTML, CSS, and JavaScript**.  
The application allows event organizers to quickly verify and register participants by scanning QR codes or entering roll numbers, while automatically updating Google Sheets in real time.

---

## Features

- QR Code scanning using device camera
- Manual roll number entry
- Real-time participant validation
- Live counters for successful, duplicate, and error entries
- Automatic event check-in logging
- Checkpoint-based entry tracking
- Audit logging for all attempts
- Audio and visual feedback for responses
- Mobile-friendly interface
- Concurrency protection using LockService

---

## Technologies Used

- HTML
- CSS
- JavaScript
- Google Apps Script
- Google Sheets
- html5-qrcode library

---

## System Overview

The system works with a **frontend interface** and a **Google Apps Script backend** connected to Google Sheets.

### Frontend
Handles:
- QR scanning
- User interface
- Entry submission
- Feedback display

### Backend
Handles:
- Participant lookup
- Payment validation
- Duplicate check-in prevention
- Logging check-in records
- Writing audit logs

---

## Google Sheets Database Structure

### Participants Sheet

Stores participant details and event status.

| Column | Description |
|------|-------------|
| A | Roll Number |
| B | Full Name |
| K | Payment Status |
| Other Columns | Event check-in status |

---

### Config Sheet

Stores event configurations.

| Event Name | Master Column | Target Sheet |
|-----------|---------------|-------------|

Example:

| Hackathon | C | Hackathon_Log |

---

### Event Log Sheets

Each event has its own log sheet.

| Roll_No | Full_Name | Checkpoint | Timestamp |

---

### Audit_Log Sheet

Stores all check-in attempts.

| Timestamp | Roll_No | Event | Checkpoint | Status | Result_Message |

---

## How the System Works

1. The frontend loads event configuration from the Config sheet.
2. The operator selects an event and enters a checkpoint identifier.
3. Participants scan their QR code or enter their roll number.
4. The backend verifies:
   - Roll number exists
   - Payment status is Paid
   - Participant has not already checked in
5. If valid:
   - The participant is marked as Checked-in in the master sheet
   - A record is added to the event log
   - An audit entry is created
6. The system returns a response and updates the interface counters.

---

## Setup Instructions

### 1. Create Google Sheets

Create the following sheets:

- Participants
- Config
- Audit_Log

---

### 2. Add Apps Script

Open the spreadsheet and go to:

Extensions → Apps Script

Add:
- `Index.html` (frontend)
- `Code.gs` (backend)

---

### 3. Deploy the Web App

Deploy the script as a web application:

Deploy → New Deployment → Web App

Settings:

Execute as: Me  
Access: Anyone with the link

---

### 4. Use the Application

Open the deployed web app link.  
Select an event, enter a checkpoint, and start scanning participants.

---

## Use Cases

- College technical fests
- Hackathons
- Conferences
- Workshops
- Event entry verification

---

## Author

Dinesh Udarla
