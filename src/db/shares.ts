import { supabase } from "./supabase.js";
import type { ArchitectureGraph } from "../analyzer/agent.js";

export async function saveShare(id: string, graph: ArchitectureGraph & Record<string, unknown>): Promise<void> {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase.from("shares").insert({ id, graph_json: graph });
  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
}

export async function getShare(id: string): Promise<(ArchitectureGraph & Record<string, unknown>) | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("shares").select("graph_json").eq("id", id).single();
  if (error || !data) return null;
  return data.graph_json as ArchitectureGraph & Record<string, unknown>;
}
