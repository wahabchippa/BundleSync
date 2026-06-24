// ============================================================
// SUPABASE SERVICE
// Handles permanent marking storage and retrieval
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

let supabaseClient = null;

/**
 * Get Supabase client (singleton)
 */
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  
  supabaseClient = createClient(
    config.supabase.url,
    config.supabase.serviceKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
  
  return supabaseClient;
}

/**
 * Fetch markings for multiple fleek_ids
 * @param {string[]} fleekIds - Array of fleek_id values
 * @returns {Object} - Map of fleek_id to marking data
 */
export async function getMarkingsForFleekIds(fleekIds) {
  if (!fleekIds || fleekIds.length === 0) return {};
  
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('order_markings')
    .select('fleek_id, marking_text, marked_by, updated_at')
    .in('fleek_id', fleekIds);
  
  if (error) {
    console.error('Supabase fetch error:', error);
    throw new Error(`Failed to fetch markings: ${error.message}`);
  }
  
  // Convert to a map for easy lookup
  const markingsMap = {};
  (data || []).forEach(row => {
    markingsMap[row.fleek_id] = {
      marking_text: row.marking_text,
      marked_by: row.marked_by,
      updated_at: row.updated_at,
    };
  });
  
  return markingsMap;
}

/**
 * Save or update a marking for a fleek_id
 * @param {string} fleekId - The fleek_id to mark
 * @param {string} markingText - The marking/note text
 * @param {string} markedBy - Who made the marking (optional)
 */
export async function saveMarking(fleekId, markingText, markedBy = null) {
  if (!fleekId) {
    throw new Error('fleek_id is required');
  }
  
  const supabase = getSupabaseClient();
  
  // Upsert: insert if not exists, update if exists
  const { data, error } = await supabase
    .from('order_markings')
    .upsert(
      {
        fleek_id: fleekId,
        marking_text: markingText || null,
        marked_by: markedBy,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'fleek_id',
        ignoreDuplicates: false,
      }
    )
    .select()
    .single();
  
  if (error) {
    console.error('Supabase upsert error:', error);
    throw new Error(`Failed to save marking: ${error.message}`);
  }
  
  return data;
}

/**
 * Delete a marking (optional - for cleanup)
 * @param {string} fleekId - The fleek_id to delete marking for
 */
export async function deleteMarking(fleekId) {
  if (!fleekId) {
    throw new Error('fleek_id is required');
  }
  
  const supabase = getSupabaseClient();
  
  const { error } = await supabase
    .from('order_markings')
    .delete()
    .eq('fleek_id', fleekId);
  
  if (error) {
    console.error('Supabase delete error:', error);
    throw new Error(`Failed to delete marking: ${error.message}`);
  }
  
  return { success: true };
}

/**
 * Get marking history for a fleek_id
 * @param {string} fleekId - The fleek_id to get history for
 */
export async function getMarkingHistory(fleekId) {
  if (!fleekId) return [];
  
  const supabase = getSupabaseClient();
  
  const { data, error } = await supabase
    .from('order_markings_history')
    .select('*')
    .eq('fleek_id', fleekId)
    .order('changed_at', { ascending: false });
  
  if (error) {
    console.error('Supabase history fetch error:', error);
    throw new Error(`Failed to fetch marking history: ${error.message}`);
  }
  
  return data || [];
}
