// ============================================================
// CONFIGURATION & ENVIRONMENT VARIABLES
// Set these in Vercel Dashboard -> Settings -> Environment Variables
// ============================================================

export const config = {
  // Google Sheets Configuration
  google: {
    // Service account credentials (JSON string)
    credentials: process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    // Spreadsheet ID from the URL
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID,
    // Sheet name (tab name)
    sheetName: process.env.GOOGLE_SHEET_NAME || 'Sheet1',
    // Data range (e.g., 'A:Z' for all columns)
    range: process.env.GOOGLE_SHEET_RANGE || 'A:Z',
  },
  
  // Supabase Configuration
  supabase: {
    url: process.env.SUPABASE_URL,
    // Use service role key for server-side operations
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  
  // App Configuration
  app: {
    // Number of days for the consolidation window
    consolidationWindowDays: 7,
  }
};

// Column mapping from Google Sheets headers to internal field names
// Adjust these based on your actual Google Sheet column headers
export const COLUMN_MAPPING = {
  'fleek_id': 'fleek_id',
  'Fleek ID': 'fleek_id',
  'order_number': 'order_number',
  'Order Number': 'order_number',
  'customer_id': 'customer_id',
  'Customer ID': 'customer_id',
  'created_at': 'created_at',
  'Created At': 'created_at',
  'latest_status': 'latest_status',
  'Latest Status': 'latest_status',
  'latest_status_date': 'latest_status_date',
  'Latest Status Date': 'latest_status_date',
  'item_name': 'item_name',
  'Item Name': 'item_name',
  'category': 'category',
  'Category': 'category',
  'product_type': 'product_type',
  'Product Type': 'product_type',
  'quantity_sold': 'quantity_sold',
  'Quantity Sold': 'quantity_sold',
  'customer_country': 'customer_country',
  'Customer Country': 'customer_country',
  'vendor': 'vendor',
  'Vendor': 'vendor',
  'vendor_zone': 'vendor_zone',
  'Vendor Zone': 'vendor_zone',
  'is_zone_vendor': 'is_zone_vendor',
  'Is Zone Vendor': 'is_zone_vendor',
  'qc_exclusion_type': 'qc_exclusion_type',
  'QC Exclusion Type': 'qc_exclusion_type',
  'bargain_bin_flag': 'bargain_bin_flag',
  'Bargain Bin Flag': 'bargain_bin_flag',
};
