// ============================================================
// GOOGLE SHEETS SERVICE
// Handles data extraction from Google Sheets
// ============================================================

import { sheets } from '@googleapis/sheets';
import { GoogleAuth } from 'google-auth-library';
import { config, COLUMN_MAPPING } from './config.js';

let sheetsClient = null;

/**
 * Initialize Google Sheets client with service account
 */
async function getGoogleSheetsClient() {
  if (sheetsClient) return sheetsClient;
  
  const credentials = JSON.parse(config.google.credentials);
  
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  
  sheetsClient = sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Normalize header name using column mapping
 */
function normalizeHeader(header) {
  const trimmed = String(header).trim();
  return COLUMN_MAPPING[trimmed] || trimmed.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Parse boolean values from various formats
 */
function parseBoolean(value) {
  if (value === null || value === undefined || value === '') return false;
  const str = String(value).toLowerCase().trim();
  return str === 'true' || str === 'yes' || str === '1' || str === 'y';
}

/**
 * Parse numeric values
 */
function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Fetch all data from Google Sheets and convert to array of objects
 */
export async function fetchSheetData() {
  try {
    const client = await getGoogleSheetsClient();
    
    const response = await client.spreadsheets.values.get({
      spreadsheetId: config.google.spreadsheetId,
      range: `${config.google.sheetName}!${config.google.range}`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    
    const rows = response.data.values;
    
    if (!rows || rows.length < 2) {
      return [];
    }
    
    // First row is headers
    const headers = rows[0].map(normalizeHeader);
    
    // Convert remaining rows to objects
    const data = rows.slice(1).map((row, rowIndex) => {
      const obj = {};
      
      headers.forEach((header, colIndex) => {
        let value = row[colIndex];
        
        // Parse specific field types
        if (header === 'quantity_sold') {
          value = parseNumber(value);
        } else if (header === 'is_zone_vendor' || header === 'bargain_bin_flag') {
          value = parseBoolean(value);
        } else if (value !== undefined && value !== null) {
          value = String(value).trim();
        }
        
        obj[header] = value ?? null;
      });
      
      // Add row index for reference
      obj._row_index = rowIndex + 2; // +2 because 1-indexed and header row
      
      return obj;
    });
    
    // Filter out rows without fleek_id (invalid rows)
    return data.filter(row => row.fleek_id);
    
  } catch (error) {
    console.error('Error fetching Google Sheets data:', error);
    throw new Error(`Failed to fetch sheet data: ${error.message}`);
  }
}

/**
 * Search for orders by order_number and apply 7-day window filter
 */
export async function searchOrders(orderNumber) {
  const allData = await fetchSheetData();
  
  // Find the searched order
  const searchedOrder = allData.find(
    row => String(row.order_number).toLowerCase() === String(orderNumber).toLowerCase()
  );
  
  if (!searchedOrder) {
    return { found: false, searchedOrder: null, relatedOrders: [] };
  }
  
  const customerId = searchedOrder.customer_id;
  const searchedDate = new Date(searchedOrder.created_at);
  
  // Validate date
  if (isNaN(searchedDate.getTime())) {
    throw new Error(`Invalid date format for order: ${orderNumber}`);
  }
  
  const windowDays = config.app.consolidationWindowDays;
  
  // Find all orders from the same customer within the 7-day window
  const relatedOrders = allData.filter(row => {
    if (String(row.customer_id) !== String(customerId)) return false;
    
    const orderDate = new Date(row.created_at);
    if (isNaN(orderDate.getTime())) return false;
    
    const daysDiff = Math.abs(orderDate - searchedDate) / (1000 * 60 * 60 * 24);
    return daysDiff <= windowDays;
  });
  
  // Sort by created_at ascending
  relatedOrders.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  
  return {
    found: true,
    searchedOrder,
    relatedOrders,
    customerId,
    searchedDate: searchedOrder.created_at,
    windowDays,
  };
}
