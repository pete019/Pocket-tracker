# Student Lookup Web App

This project now includes a Node.js web app that parses M-Pesa SMS text and searches a Google Sheets student database.

## Features
- Manual search by student name, parent name, or phone number
- Paste M-Pesa SMS text, parse sender and phone information, then lookup matching records
- Optional Africa's Talking webhook endpoint for incoming SMS forwarding
- Uses a public Google Sheets prototype by default
- Supports private Google Sheets access if you add `service_account.json`

## Run locally
1. Install Node.js if you do not already have it. Use a recent LTS version,  such as Node 18 or newer.
2. Open a terminal in `c:\Users\chris\OneDrive\Desktop\student_lookup_mvp`
3. Run `npm install`
4. Run `npm start`
5. Open `http://localhost:3000`

## Private Google Sheet access
1. Create a Google service account and download the JSON key.
2. Save that file as `service_account.json` in the project root.
3. Share your Google Sheet with the service account email address.

## Africa's Talking webhook
1. Configure Africa's Talking incoming SMS to POST to `https://<your-domain>/api/webhook`
2. The endpoint accepts JSON or form data containing `text` / `message` and `from`
3. The server parses the SMS and returns matching student records

## Notes
- The current app uses the prototype sheet from your original link.
- If the sheet is not public, you must supply a service account JSON file and share the sheet.
- The app lazy-loads the googleapis library only when a service account is present, so the public-sheet mode works without installing googleapis.
