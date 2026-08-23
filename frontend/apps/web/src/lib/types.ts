/** أنواع مشتركة تعكس عقد الخادم. لا `any` في أي مكان. */

export type Role = "TEACHER" | "ADMIN";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  role_display: string;
  is_active: boolean;
  date_joined: string;
}

export interface StoryAsset {
  asset_id: string;
  alias: string;
  kind: "images" | "audio" | "spritesheets";
  url: string;
  original_name: string;
  size_bytes: number;
  updated_at: string;
}

export interface StorySummary {
  slug: string;
  title: string;
  description: string;
  is_published: boolean;
  owner: number;
  owner_name: string;
  scene_count: number;
  asset_count: number;
  version: number;
  updated_at: string;
}

export interface StoryDetail extends StorySummary {
  story_json: Record<string, unknown>;
  layout_json: Record<string, unknown>;
  assets: StoryAsset[];
}

export interface Classroom {
  id: number;
  name: string;
  age_group: string;
  children_count: number;
  teacher: number;
  teacher_name: string;
  log_count: number;
  created_at: string;
}

export type ActivityType = "STORY" | "GAME" | "NOTE";

export interface ClassroomLog {
  id: number;
  classroom: number;
  classroom_name: string;
  activity_type: ActivityType;
  activity_display: string;
  story: number | null;
  story_title: string;
  game_id: string;
  happened_on: string;
  duration_minutes: number;
  notes: string;
  recorded_by: number;
  created_at: string;
}

export interface GameSessionResult {
  classroom: number;
  game_id: string;
  game_title: string;
  duration_seconds: number;
  completed_items: number;
  total_items: number;
}

export interface Paginated<T> {
  results: T[];
  count: number;
}
