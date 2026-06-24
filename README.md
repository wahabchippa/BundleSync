# Logistics Order Verification Tool

A professional logistics verification app that consolidates orders from the same buyer within a 7-day window, with permanent marking storage in Supabase.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Vercel)                        │
│                     public/index.html                            │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Vercel Serverless API                         │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  /api/search    │  │  /api/marking   │  │  /api/health    │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
           │                         │
           ▼                         ▼
┌─────────────────────┐   ┌─────────────────────┐
│   Google Sheets     │   │      Supabase       │
│   (Order Data)      │   │  (Permanent Marks)  │
└─────────────────────┘   └─────────────────────┘
```

## Setup Instructions

### Step 1: Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the schema from `supabase/schema.sql`
3. Get your credentials from **Settings > API**:
   - `SUPABASE_URL`: Your project URL
   - `SUPABASE_SERVICE_ROLE_KEY`: Service role key (secret)

### Step 2: Google Sheets Setup

1. Create a Google Cloud project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google Sheets API**
3. Create a **Service Account** and download the JSON key
4. Share your Google Sheet with the service account email
5. Get your **Spreadsheet ID** from the URL:
   ```
   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
   ```

### Step 3: Google Sheet Column Headers

Ensure your Google Sheet has these column headers (case-insensitive):

| Column | Description |
|--------|-------------|
| `fleek_id` | Unique identifier (PRIMARY KEY for markings) |
| `order_number` | Order number (used for searching) |
| `customer_id` | Customer identifier (used for 7-day grouping) |
| `created_at` | Order creation date (ISO format or parseable) |
| `latest_status` | Current order status |
| `latest_status_date` | Date of latest status |
| `item_name` | Product name |
| `category` | Product category |
| `product_type` | Product type |
| `quantity_sold` | Quantity ordered |
| `customer_country` | Customer's country |
| `vendor` | Vendor name |
| `vendor_zone` | Vendor zone |
| `is_zone_vendor` | Boolean (true/false, yes/no) |
| `qc_exclusion_type` | QC exclusion type |
| `bargain_bin_flag` | Boolean (true/false, yes/no) |

### Step 4: Vercel Deployment

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Deploy:
   ```bash
   vercel
   ```

3. Add environment variables in Vercel Dashboard → Settings → Environment Variables:

   | Variable | Value |
   |----------|-------|
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | Entire JSON key content (as single line) |
   | `GOOGLE_SPREADSHEET_ID` | Your spreadsheet ID |
   | `GOOGLE_SHEET_NAME` | Sheet tab name (default: `Sheet1`) |
   | `GOOGLE_SHEET_RANGE` | Data range (default: `A:Z`) |
   | `SUPABASE_URL` | Your Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |

4. Redeploy after adding variables:
   ```bash
   vercel --prod
   ```

## API Endpoints

### `GET /api/search?order_number=XXX`

Search for an order and get all related orders from the same buyer within 7 days.

**Response:**
```json
{
  "success": true,
  "searched_order_number": "ORD-50001",
  "customer_id": "CUST-8821",
  "customer_country": "UAE",
  "window_days": 7,
  "summary": {
    "total_orders": 3,
    "total_quantity": 6,
    "unique_vendors": 3,
    "bargain_bin_count": 1,
    "marked_count": 1
  },
  "orders": [
    {
      "fleek_id": "FLK-100201",
      "order_number": "ORD-50001",
      "permanent_marking": "VIP Customer",
      ...
    }
  ]
}
```

### `POST /api/marking`

Save or update a permanent marking.

**Request Body:**
```json
{
  "fleek_id": "FLK-100201",
  "marking_text": "VIP Customer - Priority Handling",
  "marked_by": "admin@company.com"
}
```

### `GET /api/health`

Check system connectivity.

## Local Development

```bash
# Install dependencies
npm install

# Run locally with Vercel CLI
vercel dev
```

Create a `.env` file for local development:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
GOOGLE_SPREADSHEET_ID=your_spreadsheet_id
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SHEET_RANGE=A:Z
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Features

- ✅ **7-Day Consolidation Window**: Groups orders from the same buyer
- ✅ **Permanent Markings**: Stored in Supabase, persist forever
- ✅ **Live Google Sheets**: Real-time data extraction
- ✅ **Merge Logic**: Combines sheet data with stored markings
- ✅ **Clean Light Theme**: Professional corporate design
- ✅ **CSV Export**: Download consolidated results
- ✅ **Keyboard Shortcuts**: `Ctrl+K` to focus search, `Esc` to clear
- ✅ **Health Monitoring**: Connection status indicator

## Customization

### Adjust Consolidation Window

Edit `api/_lib/config.js`:
```javascript
app: {
  consolidationWindowDays: 7, // Change to any number
}
```

### Add Custom Column Mappings

Edit `api/_lib/config.js` `COLUMN_MAPPING` to map your Google Sheet headers to internal field names.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Order not found" | Check if order_number exists in sheet |
| "Failed to fetch sheet data" | Verify Google credentials and sheet sharing |
| "Failed to save marking" | Check Supabase credentials and RLS policies |
| Connection shows "Offline" | Verify all environment variables are set |

## License

MIT
