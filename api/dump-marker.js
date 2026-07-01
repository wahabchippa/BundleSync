import { google } from "googleapis";

const CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || "13gjj21TS80z2HdNzWxl5Ciftfutd_4sHyEy_yJjvebM",
    sheetName: process.env.GOOGLE_SHEET_NAME || "RAW DATA",
    markerCell: "A2",
  },
};

let sheetsClient = null;

async function getSheets() {
  if (sheetsClient) return sheetsClient;

  const oauth = new google.auth.OAuth2(
    CONFIG.google.clientId,
    CONFIG.google.clientSecret,
    "https://developers.google.com/oauthplayground"
  );

  oauth.setCredentials({ refresh_token: CONFIG.google.refreshToken });
  await oauth.getAccessToken();

  sheetsClient = google.sheets({ version: "v4", auth: oauth });
  return sheetsClient;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const client = await getSheets();
    const resp = await client.spreadsheets.values.get({
      spreadsheetId: CONFIG.google.spreadsheetId,
      range: `'${CONFIG.google.sheetName}'!${CONFIG.google.markerCell}`,
      valueRenderOption: "FORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const marker = String(resp.data.values?.[0]?.[0] || "").trim();

    return res.status(200).json({
      success: true,
      marker,
      cell: CONFIG.google.markerCell,
      sheet: CONFIG.google.sheetName
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
}

export const config = { maxDuration: 30 };
